import { MongoClient } from 'mongodb'
import { env } from './config/env.js'

const { mongodbUri: uri, mongodbDbName: databaseName } = env

export const domainCollections = [
  'users',
  'students',
  'skills',
  'skill_mappings',
  'industries',
  'job_roles',
  'job_descriptions',
  'training_providers',
  'training_programs',
  'curriculums',
  'extraction_results',
  'program_alignments',
  'skill_gaps',
  'readiness_scores',
  'courses',
  'recommendations',
  'learning_roadmaps',
  'assessments',
  'assessment_attempts',
  'skill_demand',
  'skill_trends',
  'regional_skill_gaps',
  'reports',
  'government_profiles',
]

const indexes = {
  users: [[{ email: 1 }, { unique: true, sparse: true }], [{ role: 1 }]],
  students: [[{ userId: 1 }, { unique: true, sparse: true }], [{ targetRole: 1 }]],
  skills: [[{ normalizedName: 1 }, { unique: true, sparse: true }], [{ category: 1 }]],
  skill_mappings: [[{ sourceTerm: 1 }], [{ skillId: 1 }]],
  industries: [[{ name: 1 }, { unique: true, sparse: true }], [{ userId: 1 }, { unique: true, sparse: true }]],
  job_roles: [[{ industryId: 1, status: 1 }], [{ title: 1 }]],
  job_descriptions: [[{ jobRoleId: 1, createdAt: -1 }]],
  training_providers: [[{ name: 1 }, { unique: true, sparse: true }], [{ userId: 1 }, { unique: true, sparse: true }]],
  training_programs: [[{ providerId: 1, status: 1 }]],
  curriculums: [[{ trainingProgramId: 1, version: -1 }]],
  extraction_results: [[{ sourceType: 1, sourceId: 1 }], [{ createdAt: -1 }]],
  program_alignments: [[{ trainingProgramId: 1, jobRoleId: 1 }], [{ score: -1 }]],
  skill_gaps: [[{ subjectType: 1, subjectId: 1 }], [{ priority: 1 }]],
  readiness_scores: [[{ studentId: 1, targetRole: 1 }], [{ calculatedAt: -1 }]],
  courses: [[{ skillIds: 1 }], [{ providerId: 1 }]],
  recommendations: [[{ recipientType: 1, recipientId: 1 }], [{ status: 1 }]],
  learning_roadmaps: [[{ studentId: 1, status: 1 }]],
  assessments: [[{ skillId: 1 }], [{ courseId: 1 }]],
  assessment_attempts: [[{ studentId: 1, completedAt: -1 }]],
  skill_demand: [[{ skillId: 1, roleId: 1 }], [{ region: 1, recordedAt: -1 }]],
  skill_trends: [[{ skillId: 1, recordedAt: -1 }]],
  regional_skill_gaps: [[{ region: 1, skillId: 1 }], [{ priority: 1 }]],
  reports: [[{ ownerId: 1, createdAt: -1 }], [{ type: 1 }]],
  government_profiles: [[{ userId: 1 }, { unique: true, sparse: true }], [{ region: 1 }]],
}

let client
let database

export async function connectToDatabase() {
  if (database) return database

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 300000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 5000,
  })

  await client.connect()
  database = client.db(databaseName)
  await database.command({ ping: 1 })
  await initializeDatabase()
  return database
}

async function initializeDatabase() {
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name))

  for (const collectionName of domainCollections) {
    if (!existing.has(collectionName)) await database.createCollection(collectionName)
    for (const [keys, options] of indexes[collectionName] || []) {
      await database.collection(collectionName).createIndex(keys, options)
    }
  }
}

export function getDatabaseName() {
  return databaseName
}

export function getDatabase() {
  if (!database) throw new Error('MongoDB is not connected')
  return database
}

export function isDatabaseConnected() {
  return Boolean(database)
}

export async function closeDatabase() {
  if (client) await client.close()
  client = undefined
  database = undefined
}
