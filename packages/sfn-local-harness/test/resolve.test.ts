import { describe, expect, it } from 'vitest';
import { resolveIntrinsics, type ResolveContext } from '../src/resolve.js';

const ctx: ResolveContext = {
  region: 'us-east-1', accountId: '123456789012', partition: 'aws', urlSuffix: 'amazonaws.com',
  ref: (id) => `ref:${id}`,
  getAtt: (id, attr) => `att:${id}.${attr}`,
};

describe('resolveIntrinsics', () => {
  it('joins with pseudo parameters', () => {
    const v = { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':states:::lambda:invoke']] };
    expect(resolveIntrinsics(v, ctx)).toBe('arn:aws:states:::lambda:invoke');
  });
  it('resolves GetAtt in array and string forms', () => {
    expect(resolveIntrinsics({ 'Fn::GetAtt': ['Fn1', 'Arn'] }, ctx)).toBe('att:Fn1.Arn');
    expect(resolveIntrinsics({ 'Fn::GetAtt': 'Fn1.Arn' }, ctx)).toBe('att:Fn1.Arn');
  });
  it('resolves Sub with pseudo, Ref and GetAtt', () => {
    expect(resolveIntrinsics({ 'Fn::Sub': '${AWS::Region}/${MyTable}/${Fn1.Arn}' }, ctx)).toBe('us-east-1/ref:MyTable/att:Fn1.Arn');
    expect(resolveIntrinsics({ 'Fn::Sub': '${!Literal}' }, ctx)).toBe('${Literal}');
  });
  it('recurses and leaves plain values alone', () => {
    const v = { a: [1, 'x', null, true, { Ref: 'T' }], b: { c: { 'Fn::GetAtt': ['F', 'Arn'] } } };
    expect(resolveIntrinsics(v, ctx)).toEqual({ a: [1, 'x', null, true, 'ref:T'], b: { c: 'att:F.Arn' } });
  });
  it('supports Select and Split', () => {
    expect(resolveIntrinsics({ 'Fn::Select': [1, { 'Fn::Split': [':', 'a:b:c'] }] }, ctx)).toBe('b');
  });
  it('throws on unsupported intrinsics', () => {
    expect(() => resolveIntrinsics({ 'Fn::ImportValue': 'x' }, ctx)).toThrow('Unsupported intrinsic Fn::ImportValue');
    expect(() => resolveIntrinsics({ 'Fn::Sub': ['x', {}] }, ctx)).toThrow('Unsupported intrinsic Fn::Sub (array form)');
  });
});
