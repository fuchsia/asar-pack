ASAR pack
=========

A simple, zero-dependency library to programatically create electron's ASAR files
in memory without touching the filesystem or leaving undeleted temp files.

```
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

If you need files bigger than those that can be created in memory,
if need to unpack files, or you need a comamnd line tool, you'll need to use
the "official" [asar library.](https://github.com/electron/asar)


install
-----

```
npm install asar-pack
```

It's just the single ESM module `lib/pack.mjs`. It needs node path and crypto modules.
The latter is unnecessary (or could be replace with subtle cyrpto) and the former
we could hack. But is there a case for needed to call this fromt he web?
 

pack
----

```
buffer = pack( iterator, options );
```

- `iterator` 
  
  An iterator which returns dictionary objects with the syntax:

  ```
  {
     name: 'member/name',
     data: stringOrData,
      // integritySource: stringOrData   
  }
  ```
    
  - `name`

     This is the "filename" within the archive; e.g. `'foo/bar.html'` will be
     available as `'/path/to/app.asar/foo/bar.html'`.

     Forward slashes are supported on windows. (And the directory separator never ends 
     up in the archive.)
     
     Any root (including the drive, on Windows) or opening './' is excluded. 
     So `'/foo/bar'', `'foo/bar'`, `'./foo/bar'`, and `'c:\\foo\\bar'` will all be `'archive.asar/foo/bar'`

     It's illegal for any component in path to be be `'..'` or `'.'` - unless `'.'` is the 
     very first component. So `'./foo/bar'` is allowed but `'foo/./bar'` and 
     `'foo/../bar'` are illegal. 


  - `data`

     This can either be string - in which case `TextEncoder` is used to convert it
     to utf8 - or it can be a "buffer" containing the data.

     A buffer can be a node buffer. But it can be any `TypedArray` or `DataView`.

  - `integritySource`

     It appears the stock asar library calculates the integrity from the 
     original file, not its transformed output. So `integritySource`, if present,
     is used to calculate the hashes. 
 
     It is simply the untransformed data. It takes the same form as `data`; i.e.
     it's the text or a "buffer" containign the data.

     ```
     const orgText = fs.readFileSync('myfile.json'),
           newText = JSON.stringify(JSON.parse(orgText).main = "electron.js");

     cosnt asar = pack( [{name:'package.json', data: newText, integritySource:orgText}] );
     ```
     
    
- `options`
  
   An optional bag of options. You can set `integity: false` to stop sha256 hashes
   be calculated and added to the archvie.  Electron 18.2.1 appears not to need them. YMMV. 
   

File Format
----------

The file format appears to be:
   
- DWORD: 4
- DWORD: directoryLength + paddingLength + 8
- DWORD: directoryLength + paddingLength + 4
- DWORD: directoryLength
- byte[]: directoryText
- byte[]: padding (0-3 null bytes used to DWORD align the data.)
- byte[]: archive members

Byte order is little endian.

The directoryText is JSON. For the schmea, see the original asar.

Archive members follow sequentially without alignment padding. But their position
is set by the directory.

This is based on empirical observations and hunches. 
It appears to have arrisen because there are two of Google's "pickle" archives:
one for the directory length and a one for the directory text.
There aren't enough test cases covering this to confirm it.




      
     
  


 

 

 



 
 

 
