import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDate,requestDateRange,matchesRequestDate} from '../app/request-dates.mjs';
test('Date presets use Melbourne calendar months including year and leap boundaries',()=>{
 assert.deepEqual(requestDateRange('month','','',new Date('2026-10-31T14:00:00Z')),{from:'2026-11-01',to:'2026-11-01'});
 assert.deepEqual(requestDateRange('previous','','',new Date('2026-01-15T00:00:00Z')),{from:'2025-12-01',to:'2025-12-31'});
 assert.deepEqual(requestDateRange('previous','','',new Date('2024-03-15T00:00:00Z')),{from:'2024-02-01',to:'2024-02-29'});
});
test('Custom range includes both days in Melbourne and supports open boundaries',()=>{
 const range=requestDateRange('custom','2026-10-30','2026-10-30');
 assert.equal(matchesRequestDate({createdAt:'2026-10-29T13:00:00Z'},range),true);
 assert.equal(matchesRequestDate({createdAt:'2026-10-30T12:59:59Z'},range),true);
 assert.equal(matchesRequestDate({createdAt:'2026-10-30T13:00:00Z'},range),false);
 assert.equal(matchesRequestDate({createdAt:'2026-10-29T12:59:59Z'},range),false);
 assert.equal(matchesRequestDate({createdAt:'2026-10-30T00:00:00Z'},{from:'2026-10-30',to:''}),true);
 assert.equal(matchesRequestDate({createdAt:'2026-10-30T00:00:00Z'},{from:'2026-10-31',to:'2026-10-30'}),false);
 assert.equal(matchesRequestDate({},requestDateRange('all')),true);
 assert.equal(matchesRequestDate({},range),false);
 assert.equal(requestDate('invalid'),'');
});
