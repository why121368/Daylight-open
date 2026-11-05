#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { S3Client, HeadBucketCommand, CreateBucketCommand, DeleteBucketPolicyCommand } from '@aws-sdk/client-s3';

/** Deployment-only initialization. Existing objects are preserved; anonymous bucket policies are removed. */
export async function bootstrapPrivateBucket(client, bucket) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '')) throw new Error('A valid private bucket name is required.');
  try { await client.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch (error) {
    if (error.$metadata?.httpStatusCode !== 404 && !['NotFound', 'NoSuchBucket'].includes(error.name)) throw error;
    try { await client.send(new CreateBucketCommand({ Bucket: bucket })); }
    catch (createError) { if (createError.name !== 'BucketAlreadyOwnedByYou') throw createError; }
  }
  await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const key of ['DAYLIGHT_OSS_ENDPOINT', 'DAYLIGHT_OSS_BUCKET', 'DAYLIGHT_OSS_ACCESS_KEY', 'DAYLIGHT_OSS_SECRET_KEY']) {
    if (!process.env[key]) throw new Error(`Bucket bootstrap requires ${key}.`);
  }
  const client = new S3Client({ endpoint: process.env.DAYLIGHT_OSS_ENDPOINT, region: process.env.DAYLIGHT_OSS_REGION || 'us-east-1',
    forcePathStyle: process.env.DAYLIGHT_OSS_FORCE_PATH_STYLE === '1', maxAttempts: 3,
    credentials: { accessKeyId: process.env.DAYLIGHT_OSS_ACCESS_KEY, secretAccessKey: process.env.DAYLIGHT_OSS_SECRET_KEY } });
  try { await bootstrapPrivateBucket(client, process.env.DAYLIGHT_OSS_BUCKET); console.log('Private object bucket initialized; existing objects preserved.'); }
  catch (error) {
    // Connection strings and service credentials never enter bootstrap logs.
    console.error(`Private bucket initialization failed (${error.name || 'Error'}). Check endpoint, bucket ownership and credentials.`);
    process.exitCode = 1;
  } finally { client.destroy(); }
}
