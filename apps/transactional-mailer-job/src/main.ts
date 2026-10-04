import { Hono } from 'hono';
const app = new Hono();

app.get('/', (c) => c.text('Hello word!'));

export default app;
