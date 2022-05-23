ASAR pack
=========

Programmatically create Electron's ASAR files in memory.

```js
import * as fs from "fs";
import pack from "asar-pack";

const buffer = pack( [
    { name: 'src/main.js', data: fs.readFileSync( '../src/main.js' ) },
    { name: 'package.json', data: JSON.stringify( { main: "src/main.js" } )  }
}());

fs.writeFileSync( '../out/myfile.asar', buffer );
```

If your archive can't fit in memory, you'll need
the "official" [asar library.](https://github.com/electron/asar) (But, if you can load
all the files, try `packv()`.)

There's no command line tool. Again, use the offcial one.


install
-----

```
npm install asar-pack
```

It's a single ESM module [`lib/pack.mjs`](lib/pack.mjs). 

It can't be used from a browser because it depends on node's `path`, 
`crypto` and `Buffer` modules. (These limitations, could be 
side-stepped.)

usage
----

```js
import pack from "asar-pack";
const buffer = pack( members );
```

also
```js
import {pack,packv} from "asar-pack";
```

pack( members\[, options\] )
-------------
* `members`: &LT;Iterable&GT; yielding [&LT;ArchiveMember&GT;](#archivemember)
* `options`: &LT;Object&GT;
    + `integrity`: &LT;boolean&GT;
* Returns: [&LT;Buffer&GT;](https://nodejs.org/api/buffer.html#class-buffer) containing the asar.

Create a buffer containing the archive. 

Members are output to the final archive in the order they are passed to `pack()`.
    
Using `pack( members, {integrity:false})` stops sha256 hashes being added to the archive directory for each individual member.
Electron 18.2.1 doesn't seem to check them (relying instead on a single hash for the whole archive).  YMMV.

_N.B. This function can be both imported explicitly as `pack()` and also as the (unnamed) default for the module. It's the same function, either way._
 
ArchiveMember
------------
```js
{
     name: 'member/name',
     data: bufferOrString,  
     // integritySource: stringOrData   
}
```
### `name` (required)
* type &LT;string&GT;

The "filename" within the archive; e.g. `foo/bar.html` will be
available as `/path/to/app.asar/foo/bar.html`.
     
Names are case sensitive. 
     
Duplicate names aren't permitted. 
     
Forward slashes are supported on Windows. 
     
The root, root drive, or opening `.` is stripped.
So `foo/bar`, `/foo/bar`, `./foo/bar`, and `c:\foo\bar` all reference `archive.asar/foo/bar`

No component can be `.` or `..` (except for an initial `.`). So `foo/./bar` and 
`foo/../bar` are illegal (but `./foo/bar` is permitted).

### `data` (required) 
* type: &LT;string&GT; | &LT;Buffer&GT; | [&LT;ArrayBufferView&GT;](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)
     
The data to include in the archive for this file.

Strings are converted  to UTF8 via `TextEncoder`.

Buffers and ArrayBufferViews don't have to start or stop at the beginning or end
of the underlying buffer.

The data will be referenced exactly once. So this would work:
```js
class FileSync {
    constructor(name) {
        this.name = name;
    }
    get data() {
        return fs.readFileSync(this.name);
    }
};
pack( [ new FileSync( "./main.js") ] );
```
         
### `integritySource` (optional) 
* type: &LT;string&GT; | &LT;Buffer&GT; | [&LT;ArrayBufferView&GT;](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)

The stock asar library calculates the integrity from the 
original file, not its transformed value. If you want to replicate this
behaviour (!) set the `integritySource` to the untransformed data. Otherwise
omit it.

As per `data`, it's either text to be utf8 encoded or a "buffer":
     
```js
const orgText = fs.readFileSync('myfile.json'),
      json = JSON.parse(orgText);
     
json.main = "electron.js";
const newText = JSON.stringify(json);

const asar = pack( [{ name:'package.json', data: newText, integritySource: orgText }] );
```
packv( members\[, options\] )    
------------------------------
* `members`: &LT;Iterable&GT; yielding [&LT;ArchiveMember&GT;](#archivemember)
* `options`: &LT;Object&GT;
    + `integrity`: &LT;boolean&GT;
* Return: [&LT;Buffer[]&GT;](https://nodejs.org/api/buffer.html#class-buffer)

Create the headers for the archive, and format data members as Uint8Arrays, but stop short 
of concatenating them into a single chunk of memory.

`pack()` itself is just the convenience function:
```js
const pack = ( members, options ) => Buffer.concat( packv( members, options ) );
```

If memory is tight, try:
```js
import {packv} from "asar-pack";
import * as fs "from "fs";

const buffers = packv( members );
const fh = fs.openSync( 'app.asar', 'w' );
fs.writevSync( fh, buffers );
fs.closeSync(fh);
```    
    
 
File Format
----------
The file format appears to be:
   
- DWORD: 4
- DWORD: directory.length + padding.length + 8
- DWORD: directory.length + padding.length + 4
- DWORD: directory.length
- byte[]: directory (JSON data describing the files and their positions.)
- byte[]: padding (0-3 null bytes used to DWORD align the data.)
- byte[]: archive data

This analysis is based on hunches and empirical observation rather than a full deconstruction 
of the code. There aren't enough test cases covering the code to fully confirm this.

### Header
Despite the lack of an explicit identifier (e.g. begining the file with the characters 'asar')
the first 16 bytes are distinctive.

They appear to be two of Google's "Pickle" archives. The first contains the length
of the directory pickle. The second _is_ the directory pickle.  (This was probably
a misunderstanding of how pickle works.)

Byte order is little endian (not network order.)

### Directory
The directory is JSON. It lists the size and position of archive members within the body
of the archive, and their names. For the full schema, see the offical distribution.

The integrity field for individual members seems to be ignored by Electron 18.2.1 and the official
library records incorrect values for transformed files.

There is no hash for the directory iself. (Or if there is, I've missed it.)
