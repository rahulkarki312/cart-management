import express, { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerFile from '../swagger-output.json';
import { sessionMiddleware } from './middleware/session';
import cartRoutes from './routes/cartRoutes'; 

const app = express();

const PORT = 3000;

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerFile));

app.use(express.json());

app.use(sessionMiddleware); // Session middleware must come before routes that use session

app.get('/', (req, res) => {
    if (req.session) {
      req.session.views = (req.session.views || 0) + 1;
      res.send(`You have viewed this page ${req.session.views} times.`);
    } else {
        res.send('Session not available.');
    }

        
});

// New Cart API routes
app.use('/cart', cartRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});


