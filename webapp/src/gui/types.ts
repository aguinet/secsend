import {ZipArchive} from './zip';

export class NamedZipArchive extends ZipArchive {
  name: string;
}

export type FileOrArchive = File | NamedZipArchive;
