// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
dotenv.config();
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use('/api', routes);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
