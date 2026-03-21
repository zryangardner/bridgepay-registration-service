import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import usersRouter from './routes/users';
import friendsRouter from './routes/friends';
import { runMigrations } from './db/migrate';

dotenv.config();

const app = express();
const PORT = process.env['PORT'] ?? 3000;

const corsOptions = {
  origin: process.env['CORS_ORIGIN'] || 'http://localhost:5173',
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);

async function startServer() {
  const maxRetries = 10;
  const retryDelay = 3000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Migration attempt ${attempt}/${maxRetries}...`);
      await runMigrations();
      app.listen(PORT, () => {
        console.log(`Registration service running on port ${PORT}`);
      });
      return;
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err);
      if (attempt === maxRetries) {
        console.error('Max retries reached, exiting.');
        process.exit(1);
      }
      console.log(`Retrying in ${retryDelay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

startServer();

export default app;
