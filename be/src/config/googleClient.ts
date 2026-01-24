import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getConfigValue } from '../services/configService.js';

dotenv.config();

const { JWT } = google.auth;

// Assuming your environment variables are correctly set
const clientEmail: string = (getConfigValue('GOOGLE_CLIENT_EMAIL') as string | null) ?? '';
const privateKey: string =
  ((getConfigValue('GOOGLE_PRIVATE_KEY') as string | null) ?? '').replace(/\\n/g, '\n');
const scopes: string[] = ['https://www.googleapis.com/auth/spreadsheets'];

// Create a client with the credentials
const googleClient = new JWT(
    clientEmail,
    undefined, // No need for a key file when using environment variables
    privateKey,
    scopes,
);

export default googleClient;
