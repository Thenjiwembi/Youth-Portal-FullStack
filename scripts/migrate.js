const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');
const vm = require('vm');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  await connection.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await connection.query(sql);
    const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
    const context = { window: {} };
    vm.runInNewContext(dataSource, context);
    context.opportunitiesData = context.window.opportunitiesData;
    for (const item of context.opportunitiesData || []) {
      await connection.query(`INSERT INTO public.opportunities (id, title, organisation, category, location, experience_level, closing_date, short_description, full_description, image_url, image_alt, requirements, documents_required, application_link, source_url, source_name, verification_status, verified_at, updated_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19) ON CONFLICT (id) DO NOTHING`, [item.id, item.title, item.organisation, item.category, item.location, item.experienceLevel, item.closingDate, item.shortDescription, item.fullDescription, item.imageUrl || null, item.imageAlt || null, JSON.stringify(item.requirements || []), JSON.stringify(item.documentsRequired || []), item.applicationLink || null, item.sourceUrl || null, item.sourceName || null, item.verificationStatus || 'sample', item.verifiedAt || null, item.updatedDate || null]);
    }
    console.log('Database migration completed.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
