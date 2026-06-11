import Foundation
import GRDB

// Synced record types, mirroring the desktop schema in
// backend-api/database/models.py. Column names are snake_case to match the
// wire protocol exactly: a payload's `data` dict is the desktop row's columns
// minus `id`, with FK columns travelling as `<col>__ref` record_id keys
// (engine.py FK_REFS). Swift properties are camelCase; GRDB's snake_case
// strategies bridge the two. `Loom` prefix avoids shadowing Foundation.Calendar.

public struct LoomCalendar: Equatable {
    public var id: Int64?
    public var name: String
    public var description: String?
    public var color: String?
    public var createdViaSync: Bool?
    public var isCourse: Bool?
    public var courseCode: String?
    public var termStart: String?
    public var termEnd: String?
    public var lastModified: String?
    public var deletedAt: String?

    public init(
        id: Int64? = nil,
        name: String,
        description: String? = nil,
        color: String? = "#6366f1",
        createdViaSync: Bool? = false,
        isCourse: Bool? = false,
        courseCode: String? = nil,
        termStart: String? = nil,
        termEnd: String? = nil,
        lastModified: String? = nil,
        deletedAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.color = color
        self.createdViaSync = createdViaSync
        self.isCourse = isCourse
        self.courseCode = courseCode
        self.termStart = termStart
        self.termEnd = termEnd
        self.lastModified = lastModified
        self.deletedAt = deletedAt
    }
}

public struct LoomEvent: Equatable {
    public var id: Int64?
    public var title: String
    public var startTime: String
    public var endTime: String
    public var calendarId: Int64
    public var isRecurring: Bool?
    public var recurrenceDays: String?
    public var recurrenceEnd: String?
    public var description: String?
    public var uniqueDescription: String?
    public var reminderMinutes: Int?
    public var externalUid: String?
    public var timezone: String?
    public var isAllDay: Bool?
    public var skippedDates: String?
    public var perDayTimes: String?
    public var checklist: String?
    public var actualStart: String?
    public var actualEnd: String?
    public var missedAt: String?
    public var location: String?
    public var travelTimeMinutes: Int?
    public var eventType: String?
    public var prepMinutes: Int?
    public var reminderSource: String?
    public var dependsOnEventId: Int64?
    public var dependsOffsetMinutes: Int?
    public var lastModified: String?
    public var deletedAt: String?
    public var connectionCalendarId: String?
    public var externalId: String?
    public var externalEtag: String?
    public var lastSyncedAt: String?
    public var assignmentId: Int64?

    public init(
        id: Int64? = nil,
        title: String,
        startTime: String,
        endTime: String,
        calendarId: Int64,
        isRecurring: Bool? = false,
        recurrenceDays: String? = nil,
        recurrenceEnd: String? = nil,
        description: String? = nil,
        uniqueDescription: String? = nil,
        reminderMinutes: Int? = nil,
        externalUid: String? = nil,
        timezone: String? = "local",
        isAllDay: Bool? = false,
        skippedDates: String? = nil,
        perDayTimes: String? = nil,
        checklist: String? = nil,
        actualStart: String? = nil,
        actualEnd: String? = nil,
        missedAt: String? = nil,
        location: String? = nil,
        travelTimeMinutes: Int? = nil,
        eventType: String? = nil,
        prepMinutes: Int? = nil,
        reminderSource: String? = "none",
        dependsOnEventId: Int64? = nil,
        dependsOffsetMinutes: Int? = nil,
        lastModified: String? = nil,
        deletedAt: String? = nil,
        connectionCalendarId: String? = nil,
        externalId: String? = nil,
        externalEtag: String? = nil,
        lastSyncedAt: String? = nil,
        assignmentId: Int64? = nil
    ) {
        self.id = id
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.calendarId = calendarId
        self.isRecurring = isRecurring
        self.recurrenceDays = recurrenceDays
        self.recurrenceEnd = recurrenceEnd
        self.description = description
        self.uniqueDescription = uniqueDescription
        self.reminderMinutes = reminderMinutes
        self.externalUid = externalUid
        self.timezone = timezone
        self.isAllDay = isAllDay
        self.skippedDates = skippedDates
        self.perDayTimes = perDayTimes
        self.checklist = checklist
        self.actualStart = actualStart
        self.actualEnd = actualEnd
        self.missedAt = missedAt
        self.location = location
        self.travelTimeMinutes = travelTimeMinutes
        self.eventType = eventType
        self.prepMinutes = prepMinutes
        self.reminderSource = reminderSource
        self.dependsOnEventId = dependsOnEventId
        self.dependsOffsetMinutes = dependsOffsetMinutes
        self.lastModified = lastModified
        self.deletedAt = deletedAt
        self.connectionCalendarId = connectionCalendarId
        self.externalId = externalId
        self.externalEtag = externalEtag
        self.lastSyncedAt = lastSyncedAt
        self.assignmentId = assignmentId
    }
}

public struct LoomTask: Equatable {
    public var id: Int64?
    public var eventId: Int64
    public var isComplete: Bool
    public var note: String?
    public var addedAt: String?
    public var status: String?
    public var priority: String?
    public var dueDate: String?
    public var estimatedMinutes: Int?
    public var deadline: String?
    public var grade: Double?
    public var weight: Double?
    public var lastModified: String?
    public var deletedAt: String?

    public init(
        id: Int64? = nil,
        eventId: Int64,
        isComplete: Bool = false,
        note: String? = nil,
        addedAt: String? = nil,
        status: String? = "backlog",
        priority: String? = "low",
        dueDate: String? = nil,
        estimatedMinutes: Int? = nil,
        deadline: String? = nil,
        grade: Double? = nil,
        weight: Double? = nil,
        lastModified: String? = nil,
        deletedAt: String? = nil
    ) {
        self.id = id
        self.eventId = eventId
        self.isComplete = isComplete
        self.note = note
        self.addedAt = addedAt
        self.status = status
        self.priority = priority
        self.dueDate = dueDate
        self.estimatedMinutes = estimatedMinutes
        self.deadline = deadline
        self.grade = grade
        self.weight = weight
        self.lastModified = lastModified
        self.deletedAt = deletedAt
    }
}

/// Per-record sync bookkeeping — mirror of the desktop's CloudSyncState.
/// A row needs pushing iff its current last_modified differs from
/// `syncedLocalModified`.
public struct CloudSyncState: Equatable {
    public var id: Int64?
    public var recordType: String
    public var localId: Int64
    public var recordId: String
    public var serverVersion: Int
    public var syncedLocalModified: String?
    public var deleted: Bool

    public init(
        id: Int64? = nil,
        recordType: String,
        localId: Int64,
        recordId: String,
        serverVersion: Int = 0,
        syncedLocalModified: String? = nil,
        deleted: Bool = false
    ) {
        self.id = id
        self.recordType = recordType
        self.localId = localId
        self.recordId = recordId
        self.serverVersion = serverVersion
        self.syncedLocalModified = syncedLocalModified
        self.deleted = deleted
    }
}

/// Single-row table, `id` always "me" — same pattern as the desktop's
/// CloudSyncConfig (and Account).
public struct CloudSyncConfig: Equatable {
    public var id: String
    public var email: String?
    public var userSub: String?
    public var pullCursor: Int64
    public var lastSyncedAt: String?

    public init(
        id: String = "me",
        email: String? = nil,
        userSub: String? = nil,
        pullCursor: Int64 = 0,
        lastSyncedAt: String? = nil
    ) {
        self.id = id
        self.email = email
        self.userSub = userSub
        self.pullCursor = pullCursor
        self.lastSyncedAt = lastSyncedAt
    }
}

// MARK: - GRDB conformances

extension LoomCalendar: Codable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "calendar"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase
    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension LoomEvent: Codable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "event"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase
    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension LoomTask: Codable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "task"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase
    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension CloudSyncState: Codable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "cloudsyncstate"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase
    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension CloudSyncConfig: Codable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "cloudsyncconfig"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase
}
