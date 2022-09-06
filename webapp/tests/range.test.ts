import {StreamRange} from '../src/core/range';

test('range', () => {
  const orgChunkSize = 1024;
  const tagLen = 16;
  {
    const range = StreamRange.compute(orgChunkSize+tagLen, orgChunkSize, orgChunkSize+1, null);
    expect(range.inChunkBegin).toStrictEqual(1);
    expect(range.inStreamSeekBytes).toStrictEqual(orgChunkSize+tagLen);
    expect(range.outStreamBeginSkip).toStrictEqual(1);
  }
  {
    const range = StreamRange.compute(orgChunkSize, orgChunkSize+tagLen, orgChunkSize+tagLen+1, null);
    expect(range.inChunkBegin).toStrictEqual(1);
    expect(range.inStreamSeekBytes).toStrictEqual(orgChunkSize);
    expect(range.outStreamBeginSkip).toStrictEqual(1);
  }
});
