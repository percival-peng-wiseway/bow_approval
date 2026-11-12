import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
// Execute real SQLite SQL with the D1 prepared-statement/batch surface. Only the
// binding transport is emulated; migrations, joins, CAS and transactions are real.
export async function testD1(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of (await fs.readdir(new URL('../../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(await fs.readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
 const db={prepare(sql){const make=args=>({bind(...values){return make(values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}});return make([]);},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close(){sqlite.close();}};
 return db;
}
