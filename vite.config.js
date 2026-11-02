import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { addressLookup } from './server/address.js';
import { staffAccount } from './server/staff.js';
import { vehicleLookup } from './server/vehicle.js';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-vehicle-api',
      configureServer(server) {
        const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
        server.middlewares.use('/api/address', async (req, res) => {
          const result = await addressLookup(req.method, new URL(req.url, 'http://localhost').searchParams.get('postcode'), env);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(result.body));
        });
        server.middlewares.use('/api/staff', async (req, res) => {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          let body = null;
          try { body = JSON.parse(raw); } catch { body = null; }
          const result = await staffAccount(req.method, req.headers.authorization, body, env);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(result.body));
        });
        server.middlewares.use('/api/vehicle', async (req, res) => {
          const result = await vehicleLookup(req.method, new URL(req.url, 'http://localhost').searchParams.get('registration'), env);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(result.body));
        });
      },
    },
  ],
}));
