// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes.js';
dotenv.config();
const app = express();
const allowedOrigins = ['https://innovatexx.netlify.app'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(express.json());
app.use('/api', routes);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
