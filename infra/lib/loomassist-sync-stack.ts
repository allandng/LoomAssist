import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

/**
 * LoomAssist sync stack — roadmap §4.
 *
 * Single DynamoDB table holds vault metadata, encrypted records, and the
 * device registry, all keyed by Cognito `sub`. The server only ever sees
 * ciphertext; the KEK never leaves the device.
 *
 * RemovalPolicy is DESTROY across the board while this is a single-developer
 * v0 — revisit before any non-tester user has data here.
 */
export class LoomAssistSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Storage -----------------------------------------------------------
    const table = new dynamodb.Table(this, 'SyncTable', {
      tableName: 'loomassist-sync',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at', // tombstones purge 90 days after delete
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Sparse index: only record items carry `last_modified`, so vault and
    // device items never show up in delta queries.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi-last-modified',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'last_modified', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Identity ----------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'loomassist-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 10,
        requireDigits: false,
        requireSymbols: false,
        requireUppercase: false,
        requireLowercase: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SRP only — the password doubles as KEK input and must never transit
    // in cleartext (roadmap §4 key model).
    const desktopClient = userPool.addClient('DesktopClient', {
      userPoolClientName: 'loomassist-desktop',
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
    });

    // --- Sync API ----------------------------------------------------------
    const logGroup = new logs.LogGroup(this, 'SyncApiLogs', {
      retention: logs.RetentionDays.ONE_WEEK, // roadmap §8 cost-safety
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const syncFn = new lambda.Function(this, 'SyncApiFn', {
      functionName: 'loomassist-sync-api',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('lambda/sync_api'),
      environment: { TABLE_NAME: table.tableName },
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logGroup,
    });
    table.grantReadWriteData(syncFn);

    const authorizer = new HttpJwtAuthorizer(
      'CognitoJwt',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [desktopClient.userPoolClientId] },
    );

    const api = new apigwv2.HttpApi(this, 'SyncApi', {
      apiName: 'loomassist-sync',
      defaultAuthorizer: authorizer,
    });

    const integration = new HttpLambdaIntegration('SyncFnIntegration', syncFn);
    const routes: Array<[apigwv2.HttpMethod, string]> = [
      // Vault setup (rare)
      [apigwv2.HttpMethod.POST, '/vault/init'],
      [apigwv2.HttpMethod.GET, '/vault/info'],
      [apigwv2.HttpMethod.POST, '/vault/rotate-password'],
      // Records (constant)
      [apigwv2.HttpMethod.GET, '/records'],
      [apigwv2.HttpMethod.GET, '/records/{id}'],
      [apigwv2.HttpMethod.PUT, '/records/{id}'],
      [apigwv2.HttpMethod.DELETE, '/records/{id}'],
      [apigwv2.HttpMethod.POST, '/records/batch'],
      // Devices (occasional)
      [apigwv2.HttpMethod.GET, '/devices'],
      [apigwv2.HttpMethod.DELETE, '/devices/{id}'],
    ];
    for (const [method, path] of routes) {
      api.addRoutes({ path, methods: [method], integration });
    }

    // --- Outputs -----------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: desktopClient.userPoolClientId });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
