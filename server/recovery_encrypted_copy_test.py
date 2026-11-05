import unittest,tempfile,importlib.util,hashlib,secrets,base64,subprocess,sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
from cryptography.exceptions import InvalidTag
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/recovery-encrypted-copy.py'
spec=importlib.util.spec_from_file_location('backup_copy',SCRIPT);backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)

class EncryptedRecoveryTests(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory(prefix='encrypted-backup-test-',dir=ROOT/'work')
  self.root=Path(self.directory.name);self.key=secrets.token_bytes(32);self.plain=b'synthetic-fixture\n'+secrets.token_bytes(1048600)
  self.sha=hashlib.sha256(self.plain).hexdigest();header=backup.MAGIC+secrets.token_bytes(12)
  encoder=Cipher(algorithms.AES(self.key),modes.GCM(header[-12:])).encryptor();encoder.authenticate_additional_data(header)
  self.source=self.root/'fixture.dlbak';self.source.write_bytes(header+encoder.update(self.plain)+encoder.finalize()+encoder.tag)
 def tearDown(self):self.directory.cleanup()
 def run_decrypt(self,target):
  return subprocess.run([sys.executable,str(SCRIPT),'decrypt','--source',str(self.source),'--out',str(target),'--expected-sha256',self.sha],input=base64.b64encode(self.key).decode()+'\n',text=True,capture_output=True)
 def test_full_stream_and_expected_digest(self):
  self.assertEqual(backup.verify(self.source,self.key,self.sha)['plaintextBytes'],len(self.plain))
  with self.assertRaises(ValueError):backup.verify(self.source,self.key,'0'*64)
 def test_changed_authentication_tag_is_detected(self):
  data=bytearray(self.source.read_bytes());data[-1]^=1;self.source.write_bytes(data)
  with self.assertRaises(InvalidTag):backup.verify(self.source,self.key,self.sha)
  target=self.root/'restored.tar';result=self.run_decrypt(target)
  self.assertNotEqual(result.returncode,0);self.assertFalse(target.exists());self.assertFalse(target.with_name(target.name+'.partial').exists())
  self.assertNotIn(base64.b64encode(self.key).decode(),result.stdout+result.stderr)
 def test_decrypt_publishes_only_verified_plaintext(self):
  target=self.root/'restored.tar';result=self.run_decrypt(target)
  self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(target.read_bytes(),self.plain)
 def test_existing_output_is_preserved(self):
  target=self.root/'restored.tar';target.write_text('retained-data')
  self.assertNotEqual(self.run_decrypt(target).returncode,0);self.assertEqual(target.read_text(),'retained-data')

if __name__=='__main__':unittest.main()
