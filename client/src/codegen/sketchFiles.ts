/**
 * Assembles the file set sent to POST /api/compile.
 *
 * This exists as a standalone function rather than living inline in the
 * Verify/Upload button because it is exactly the kind of logic that looks
 * trivial and silently breaks: a sketch that exposes variables includes
 * "AwryLink.h", and if the firmware does not travel with it the compile fails
 * on a missing header with no way for the user to supply it.
 */
import { AWRYLINK_FILES } from '@/codegen/awrylinkSource';
import type { GenerateResult } from '@/codegen/generate';

export interface SketchFile {
  readonly name: string;
  readonly content: string;
}

export function sketchFilesFor(result: GenerateResult): SketchFile[] {
  const files: SketchFile[] = [{ name: 'Sketch.ino', content: result.code }];
  if (result.exposed.length > 0) {
    files.push(...AWRYLINK_FILES.map((file) => ({ name: file.name, content: file.content })));
  }
  return files;
}
