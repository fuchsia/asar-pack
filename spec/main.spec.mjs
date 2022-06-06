import {readFileSync,existsSync,statSync,unlinkSync} from "fs";
import {tmpdir} from "os";
import * as path from "path";
import {createHash} from "crypto";
import { fileURLToPath } from 'url';

import ASAR from "asar";

import defaultImport,{pack,packv} from "../lib/pack.mjs";

const SCRIPTDIR = path.dirname( fileURLToPath( import.meta.url ) ),
      BASEDIR = path.join( SCRIPTDIR, '..' );

function createTempFilename( prefix  )
    {
        const pathPrefix = path.join( tmpdir(), prefix );
        for ( ;; ) {
            const id = Math.trunc( Math.random() * 999_999_999 ),
                  filename = `${pathPrefix}-${id}.tmp`;
            if ( !existsSync( filename ) )
                return filename;
        }
    }

function Asar_fetchDirectory( asarHeaderOrHeaderBuffer )
    {
        const headerView = new DataView( asarHeaderOrHeaderBuffer.buffer, asarHeaderOrHeaderBuffer.byteOffset, asarHeaderOrHeaderBuffer.byteLength );
        const directoryBytes = headerView.getUint32( 12, true );
        const utf8Directory = new Uint8Array( asarHeaderOrHeaderBuffer.buffer, 16, directoryBytes );
        const decoder = new TextDecoder( undefined, { fatal: true }  );
        return JSON.parse( decoder.decode( utf8Directory ) );
    }

async function rawCompare( BASEDIR, filesToPack )
    {
        const ourImage = pack( function*() {
            for ( const f of filesToPack ) {
                const data = readFileSync( path.join( BASEDIR, f ) );
                yield { name: f, data };
            }
        }() );
        
          
        let officalImage;
        let destfile;
        try {
            const metadata = {};
            const files = [];
            for ( const filename of filesToPack ) {
                const absfilename = path.join( BASEDIR, filename );
                files.push( absfilename );
                const stat = statSync( absfilename );
                metadata[absfilename] = { type: stat.isDirectory() ? 'directory' : 'file', stat };  
            }
            // Do we need the directory objects or can we skip them?
            destfile = createTempFilename( 'asar-pack-test' );
            
            await ASAR.createPackageFromFiles( BASEDIR, destfile, files, metadata );
            officalImage = readFileSync( destfile );
            
        } finally {
            try {
                unlinkSync( destfile );
            } catch( err ) {
                console.error( "unlink failed", err );
            }
        }
        const c = Buffer.compare( ourImage, officalImage ); 
        if ( c ) {
            let errors = 0;
            for ( let i = 0; i < Math.min( ourImage.length, officalImage.length ); ++i ) {
                if ( ourImage[i] !== officalImage[i] ) {
                    console.log( "diff", i.toString( 16 ), officalImage[i].toString( 16 ), String.fromCharCode( officalImage[i] ), 
                        ourImage[i].toString( 16 ),
                         String.fromCharCode( ourImage[i] ),
                         );
                    if ( ++errors > 2048 ) 
                        break;
                }
            } 
        }
        return c;  
    }

it( "pack and default export should be identical" , () => {
    expect( pack ).toEqual( defaultImport ); 
} );

// FIXME: these should be stock test files and pre-generated output from asar.
it( "should create a matching archive for untransformed single block files", async () => {
    const filesToPack = [ 'lib/pack.mjs', 'package.json', 'README.md' ]; 
    const c = await rawCompare( BASEDIR, filesToPack ); 
    expect( c ).toEqual( 0 ); 
} );


describe( "the header padding", () => {
    const PADDING_FILES =[ "00000-bytes-padding.dat", "0001-bytes-padding.dat", "002-bytes-padding.dat", "03-bytes-padding.dat" ];    
    it( "should be identical for all the header padding-reference files", () => {
        const referenceLength = pack( [{ name: PADDING_FILES[0], data: new Uint8Array( 0 )}] ).length;
        for ( let i = 1; i < PADDING_FILES.length; ++i ) {
            expect( pack( [{name: PADDING_FILES[i], data: new Uint8Array( 0 )}] ).length ).toEqual( referenceLength ); 
        }
    } );
    
    // @issue Should we be using the oficial distro or should we be hard coding some referfence files?
    // These files are small enough (284 bytes) that we could base64 encode them in here.
    for ( let i = 0; i < PADDING_FILES.length; ++i ) {
        it( `should match the official asar for ${i} bytes`, async () => {
            const filesToPack = [ PADDING_FILES[i] ]; 
            const c = await rawCompare( path.join( BASEDIR, 'spec/data' ), filesToPack ); 
            expect( c ).toEqual( 0 ); 
        } );
    }

} );




describe( "the archive directory should", () => {
    it ( "allow a leading '.'", () => {
        expect( () => pack( [{ name: './world', data: '' }] ) ).not.toThrow();
    } );
    it ( "handle a leading '/'", () => {
        expect( () => pack( [{ name: '/world', data: '' }] ) ).not.toThrow();
    } );
    it ( "handle a leading 'c:\\'", () => {
        expect( () => pack( [{ name: 'c:\\world', data: '' }] ) ).not.toThrow();
    } );
    it ( "not allow names containing '..'", () => {
        expect( () => pack( [{ name: 'hello/../world', data: '' }] ) ).toThrow();
    } );
    it ( "not allow names containing '.'", () => {
        expect( () => pack( [{ name: 'hello/./world', data: '' }] ) ).toThrow();
    } );
    it ( "not allow duplicate names '.'", () => {
        expect( () => pack( [{ name: './world', data: '' }, {name: 'world', data: '' } ] ) ).toThrow();
    } );
} );

describe( "the archive data sanitiser should", () => {
    it ( "throw if data is missing", () => {
        expect( () => pack( [{ name: './world' }] ) ).toThrow();
    } );
    it ( "throw if data is null", () => {
        expect( () => pack( [{ name: './world', data: null }] ) ).toThrow();
    } );
    it ( "throw if data is an ordinary array", () => {
        expect( () => pack( [{ name: './world', data: [] }] ) ).toThrow();
    } );
    it ( "throw if data is an empty object", () => {
        expect( () => pack( [{ name: './world', data: {} }] ) ).toThrow();
    } );
    it ( "accept a pseudo-array-bufferview", () => {
        const buffer = new ArrayBuffer( 30 );
        expect( () => pack( [{ name: './world', data: { buffer, byteOffset: 0, byteLength: 10 } }] ) ).not.toThrow();
    } );
} );


it( "the multiblock integrity code should compute the integrity correctly", () => {
    const block0 = Uint8Array.from( Array.from( { length: 4 * 1024 * 1024 }, ( _,n ) => n % 137 )  ),
          block1 = Uint8Array.from( Array.from( { length: 23 * 1024 }, ( _,n ) => n % 111 )  ),
          total = Buffer.concat( [block0, block1] ); 

    const block0hash = createHash( 'sha256' ).update( block0 ).digest( 'hex' ), 
          block1hash = createHash( 'sha256' ).update( block1).digest( 'hex' ), 
          totalHash  = createHash( 'sha256' ).update( total ).digest( 'hex' );
           
    const buffers = packv( [{name:'data', data: total }] );
    const node = Asar_fetchDirectory( buffers[0] ).files.data;
    expect( node.integrity.hash ).toEqual( totalHash ); 
    expect( node.integrity.blocks ).toEqual( [block0hash, block1hash]  ); 

} );

