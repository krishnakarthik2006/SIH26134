import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongodbDbName: process.env.MONGODB_DB_NAME || 'SIH26134',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'skillsync-development-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  // Python AI microservice
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  aiServiceTimeout: Number(process.env.AI_SERVICE_TIMEOUT_MS || 30000),
  aiServiceApiKey: process.env.AI_SERVICE_API_KEY || '',
}
