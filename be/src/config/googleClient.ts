import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const { JWT } = google.auth;

// Assuming your environment variables are correctly set
const clientEmail: string = process.env.GOOGLE_CLIENT_EMAIL || '';
const privateKey: string = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
const scopes: string[] = ['https://www.googleapis.com/auth/spreadsheets'];

// Create a client with the credentials
const googleClient = new JWT(
    clientEmail,
    undefined, // No need for a key file when using environment variables
    privateKey,
    scopes,
);

export default googleClient;
