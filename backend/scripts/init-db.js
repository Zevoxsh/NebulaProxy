import { database } from './services/database.js';

console.log('Initializing database...');
database.init();
console.log('Database initialized successfully!');
process.exit(0);
