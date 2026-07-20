import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const experimentos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/experimentos' }),
  schema: z.object({
    titulo: z.string(),
    resumen: z.string(),
    estado: z.enum(['online', 'pruebas', 'archivado']),
    unidad: z.string(), // etiqueta de rack, p.ej. "U-01"
    serie: z.enum(['fundamentos', 'agentes', 'bitacora']), // a qué bastidor temático pertenece
    lang: z.enum(['es', 'en']).default('es'),
    fecha: z.date(),
  }),
});

const proyectos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/proyectos' }),
  schema: z.object({
    titulo: z.string(),
    resumen: z.string(),
    estado: z.enum(['activo', 'pausado']),
    stack: z.array(z.string()),
    repo_url: z.string().url().optional(),
    demo_url: z.string().url().optional(),
    lang: z.enum(['es', 'en']).default('es'),
    fecha: z.date(), // fecha de inicio
  }),
});

export const collections = { experimentos, proyectos };
