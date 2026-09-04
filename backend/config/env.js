import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongodbDbName: process.env.MONGODB_DB_NAME || 'SIH26134',
  nodeEnv: process.env.NODE_ENV || 'development',
}
