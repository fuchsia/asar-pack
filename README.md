ASAR pack
=========

A simple library to programatically create electron's ASAR files in memory.

```js
import {writeFileSync,readFileSync} from "node:fs";
import pack from "asar-pack";

const buffer = pack( function*() {
    for ( const filename of [ 'script.mjs', './images/img.png' ] ) {
        if ( filename.endsWith('.mjs') ) {
            const minifiedText = myminify( filename );             
            yield { name: filename, data: minifiedText  };
        } else {
            yield { name: filename, data: fs.readFileSync( filename ) };
        }           
    }
}());

fs.writeFileSync( '../out/myfile.asar', buffer );
```

If you need to unpack files, need a command line tool, or have files
bigger than can be managed in memory, then you'll need to use
the "official" [asar library.](https://github.com/electron/asar)


install
-----

```
npm install asar-pack
```

It's a single ESM module `lib/pack.mjs`. 

It can't be used from a browser as it depends on node's `path` 
and `crypto` modules. 

pack
----

```js
buffer = pack( iterable, options );
```

- `iterable` 
  
  Any iterable that provides a dictionary for each archive member:

  ```js
  {
     name: 'member/name',
     data: stringOrData,
     // integritySource: stringOrData   
  }
  ```
    
  - `name`

     The "filename" within the archive; e.g. `foo/bar.html` will be
     available as `/path/to/app.asar/foo/bar.html`.
     
     Names are case senstivive. Duplicates may not appear in the archive. 
     
     Forward slashes are supported on Windows. 
     
     The root drive, root `/` or opening `.` is excluded from the final filename.
     So `/foo/bar`, `foo/bar`, `./foo/bar`, and `c:\\foo\\bar` all reference `archive.asar/foo/bar`

     It's illegal for any component in path to be be `.` or `..` - unless `.` is the 
     very first component. So `./foo/bar` is allowed but `foo/./bar` and 
     `foo/../bar` are illegal. 
     
  - `data`

     This can be either a string - in which case `TextEncoder` is used to convert it
     to utf8 - or a "buffer" containing the data.

     A buffer can be a node buffer, a `DataView` or any `TypedArray`.

  - `integritySource`

     It appears the stock asar library calculates the integrity from the 
     original file, not its transformed output. If you want to replicate this
     beaviour (!) set the `integritySource` to the untransformed data.
      
     As per `data` it's either text to be utf8 encoded or a "buffer".
     
     ```js
     const orgText = fs.readFileSync('myfile.json'),
           newText = JSON.stringify(JSON.parse(orgText).main = "electron.js");

     cosnt asar = pack( [{name:'package.json', data: newText, integritySource:orgText}] );
     ```
     
    
- `options`
  
   An optional bag of options. You can use `{integrity: false}` to stop sha256 hashes
   being added to archive; Electron 18.2.1 appears not to need them. YMMV. 
   

File Format
----------

The file format appears to be:
   
- DWORD: 4
- DWORD: directoryLength + paddingLength + 8
- DWORD: directoryLength + paddingLength + 4
- DWORD: directoryLength
- byte[]: directoryText
- byte[]: padding (0-3 null bytes used to DWORD align the data.)
- byte[]: archive data

Byte order is little endian.

The directoryText is JSON. For the schmaa, see the original asar. This sets
the positions of archive memmbers within archive data.

The weird header structure appears to have arrisen because there are two of Google's "pickle" archives:
one for the directory length and a one for the directory text. It's based on hunches and empirical
observation rather than a full deconstruction of the code. And there aren't enough test cases covering 
the code to confirm it.




      
     
  


 

 

 



 
 

 
