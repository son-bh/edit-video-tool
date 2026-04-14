import multer from 'multer';

export function createUpload(stagingDir: string): multer.Multer {
  return multer({
    dest: stagingDir
  });
}
