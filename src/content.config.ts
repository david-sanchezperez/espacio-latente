import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const experimentos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/experimentos' }),
  schema: z.object({
    titulo: z.string(),
    resumen: z.string(),
    estado: z.enum(['online', 'pruebas', 'archivado']),
    unidad: z.string(), // etiqueta de rack, p.ej. "U-01"
    fecha: z.date(),
  }),
});

export const collections = { experimentos };
