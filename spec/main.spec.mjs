import {readFileSync,existsSync,statSync,unlinkSync} from "fs";
import {tmpdir} from "os";
import * as path from "path";
import { fileURLToPath } from 'url';

import ASAR from "asar";

import pack from "../lib/pack.mjs";

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
            console.log( "", destfile );
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

// FIXME: these should be stock test files and pre-generated output from asar.
it( "should create a matching archive for untransformed single block files", async () => {
    const filesToPack = [ 'lib/pack.mjs', 'package.json', 'README.md' ]; 
    const c = await rawCompare( BASEDIR, filesToPack ); 
    expect( c ).toEqual( 0 ); 
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
