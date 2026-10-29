import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareMemberJoinedAt } from '../src/utils/memberProfilesOrder.js';

test('members sort by joining date ascending, including after edits; unknown dates come last', () => {
  const members = [
    {id:'new',joined_at:'2026-09-01T00:00:00+00'},
    {id:'missing',joined_at:''},
    {id:'old',joined_at:'2022-09-01 00:00:00+00'},
    {id:'middle',joined_at:'2024-09-01T00:00:00Z'},
    {id:'invalid',joined_at:'invalid'},
  ];
  assert.deepEqual([...members].sort(compareMemberJoinedAt).map((m) => m.id), ['old','middle','new','missing','invalid']);
  const updated = members.map((m) => m.id === 'new' ? {...m,joined_at:'2021-01-01T00:00:00Z'} : m);
  assert.equal(updated.sort(compareMemberJoinedAt)[0].id,'new');
  assert.equal(members[0].id,'new');
});
