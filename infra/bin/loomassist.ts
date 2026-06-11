#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LoomAssistSyncStack } from '../lib/loomassist-sync-stack';

const app = new cdk.App();

// Roadmap §8: tag everything for cost attribution.
cdk.Tags.of(app).add('project', 'loomassist');

new LoomAssistSyncStack(app, 'LoomAssistSync', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'LoomAssist v3.0 E2E-encrypted sync layer (roadmap stage 2)',
});
