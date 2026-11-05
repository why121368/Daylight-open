"""Download a private backup over SSH and seal it with streaming AES-256-GCM.

Credentials enter via stdin: download reads SSH password then base64 key;
verify/decrypt read only the base64 key. Use an OS credential store for the key.
"""
import argparse,base64,hashlib,json,os,secrets,sys,time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes

MAGIC=b'DAYLIGHT-BACKUP-V1\n'
CHUNK=1024*1024

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for data in iter(lambda:stream.read(CHUNK),b''):h.update(data)
 return h.hexdigest()

def verify(path,key,expected,out=None):
 size=path.stat().st_size;header_size=len(MAGIC)+12
 if size<header_size+16:raise ValueError('INVALID_BACKUP_FORMAT')
 with path.open('rb') as source:
  header=source.read(header_size)
  if not header.startswith(MAGIC):raise ValueError('INVALID_BACKUP_FORMAT')
  source.seek(-16,2);tag=source.read(16);source.seek(header_size)
  decoder=Cipher(algorithms.AES(key),modes.GCM(header[-12:],tag)).decryptor()
  decoder.authenticate_additional_data(header)
  remaining=size-header_size-16;h=hashlib.sha256();total=0
  while remaining:
   data=source.read(min(CHUNK,remaining))
   if not data:raise ValueError('TRUNCATED_BACKUP')
   remaining-=len(data);plain=decoder.update(data);h.update(plain);total+=len(plain)
   if out:out.write(plain)
  tail=decoder.finalize();h.update(tail);total+=len(tail)
  if out:out.write(tail)
  if h.hexdigest()!=expected:raise ValueError('PLAINTEXT_DIGEST_MISMATCH')
  return {'plaintextBytes':total,'plaintextSha256':h.hexdigest(),'gcmTagVerified':True}

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('mode',choices=['download','verify','decrypt'])
 p.add_argument('--source',required=True);p.add_argument('--out');p.add_argument('--expected-sha256',required=True)
 p.add_argument('--host');p.add_argument('--user',default='root');p.add_argument('--known-hosts')
 args=p.parse_args();started=time.monotonic()
 password=sys.stdin.readline().rstrip('\r\n') if args.mode=='download' else None
 key=base64.b64decode(sys.stdin.readline().strip(),validate=True)
 if len(key)!=32:raise ValueError('EXPECTED_AES_256_KEY')
 if len(args.expected_sha256)!=64 or any(c not in '0123456789abcdef' for c in args.expected_sha256):raise ValueError('INVALID_EXPECTED_DIGEST')
 if args.mode=='verify':
  result=verify(Path(args.source),key,args.expected_sha256)
 else:
  if not args.out:p.error('--out is required')
  target=Path(args.out).resolve();partial=target.with_name(target.name+'.partial')
  if target.exists() or partial.exists():raise ValueError('OUTPUT_EXISTS')
  target.parent.mkdir(parents=True,exist_ok=True)
  try:
   if args.mode=='download':
    import paramiko,inspect
    if not args.host or not args.known_hosts:p.error('--host and --known-hosts are required')
    client=paramiko.SSHClient();client.load_host_keys(args.known_hosts);client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
     client.connect(args.host,username=args.user,password=password,look_for_keys=False,allow_agent=False,timeout=30)
     with client.open_sftp() as sftp,sftp.open(args.source,'rb') as remote,partial.open('xb') as dest:
      size=remote.stat().st_size
      if 'max_concurrent_requests' in inspect.signature(remote.prefetch).parameters:remote.prefetch(size,max_concurrent_requests=16)
      iv=secrets.token_bytes(12);header=MAGIC+iv
      encoder=Cipher(algorithms.AES(key),modes.GCM(iv)).encryptor();encoder.authenticate_additional_data(header)
      dest.write(header)
      for data in iter(lambda:remote.read(CHUNK),b''):dest.write(encoder.update(data))
      dest.write(encoder.finalize());dest.write(encoder.tag);dest.flush();os.fsync(dest.fileno())
    finally:client.close()
    result=verify(partial,key,args.expected_sha256)
    result.update({'encryptedBytes':partial.stat().st_size,'encryptedSha256':digest(partial),'encryption':'AES-256-GCM','keyStorage':'external OS credential store'})
   else:
    with partial.open('xb') as out:
     result=verify(Path(args.source),key,args.expected_sha256,out);out.flush();os.fsync(out.fileno())
   if target.exists():raise ValueError('OUTPUT_EXISTS')
   partial.rename(target)
  except BaseException:
   if partial.exists():partial.unlink()
   raise
 result.update({'ok':True,'mode':args.mode,'durationMs':round((time.monotonic()-started)*1000)})
 print(json.dumps(result,indent=2))

if __name__=='__main__':
 try:main()
 except Exception as error:
  # Third-party exceptions can contain connection details. Keep this channel content-free.
  print('Encrypted backup operation failed: '+type(error).__name__,file=sys.stderr);sys.exit(1)
