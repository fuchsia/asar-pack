
// We could actually use `crypto.subtle.digest('SHA-256', data);` in a web context;
// but that returns a promise; because...
//  
// We could also just include a BSD SHA256 implementation. 
//
import {createHash} from "crypto";
import * as path from "path";
const encoder = new TextEncoder;

function ArchiveMember_getIntegrity( bufferView )
    {
        const ALGORITHM = 'SHA256',
              BLOCK_SIZE = 4 * 1024 * 1024;
        
        const hashBuffer = b => createHash( ALGORITHM ).update( b ).digest('hex'); 

        const blocks = [];
        let pos = 0;
        for ( ; pos + BLOCK_SIZE < bufferView.byteLength; pos += BLOCK_SIZE )  
            blocks.push( hashBuffer( new Uint8Array( bufferView.buffer, bufferView.byteOffset + pos, BLOCK_SIZE ) ) );
        
        blocks.push( hashBuffer( new Uint8Array( bufferView.buffer, bufferView.byteOffset + pos, bufferView.byteLength - pos ) ) );        
                
        // No point recomputing it.
        const fileDigest = blocks.length === 1 ? blocks[0] : hashBuffer( bufferView );

        return { 
            algorithm: ALGORITHM,
            hash: fileDigest,
            blockSize: BLOCK_SIZE,
            blocks 
        }
    }

function Data_sanitiseSource( data )
    {
        if ( typeof data === 'string' ) {
            return encoder.encode( data );
        } else if ( typeof data?.byteLength === 'number' ) {
            // 1. Buffers.concat() is fussy about having Uint8Array.
            // 2. The allocated buffer might not be the size of the data - hence the slice syntax.
            return typeof data.constructor.name === 'Uint8Array' ? data : new Uint8Array( data.buffer, data.byteOffset, data.byteLength );
        } else {
            return null;
        }
    }

function Archive_sanitiseMember( archiveMember, memberIndex, withIntegrity )
    {
        if ( typeof archiveMember !== 'object' || !archiveMember )
            throw new TypeError( `Illegal archive member (\`archiveMembers[${memberIndex}]\` not an object)` );
        
        const {name,data,integritySource} = archiveMember;
        if ( typeof name !== 'string' || ! name )
            throw new TypeError( `Illegal archive member (\`archiveMembers[${memberIndex}].name\` must be a non empty string)` );
        
        const buffer = Data_sanitiseSource( data ); 
        if ( !buffer ) {
            throw new TypeError( `Illegal archive member (\`archiveMembers[${memberIndex}].data\` must be a buffer or a string)` );
        }
        
        
        const integrity = withIntegrity === false ? undefined
                            // No we don't trap invalid integeritySource values. Laziness on my part.  
                            : ArchiveMember_getIntegrity( Data_sanitiseSource( integritySource ) || buffer ); 
                            
                        
        return { name, buffer, integrity };
    }


function Path_splitFilename( filename )
    {
        const result = []
        for( ;; ){
            const {base:basename,dir,root} = path.parse( filename );
            if ( basename === '..' ) {
                throw new TypeError( "Member names cannot contain `..`" );
            } else if ( basename === '.' ) {
                if ( dir === '' ) {
                    console.assert( root === '', "path.parse invariant" );
                    break;
                }    
                throw new TypeError( "Member names cannot contain `.`" );
            } else {
                result.push( basename );
                if ( dir === root ) {
                    break;
                }
            }
            filename = dir;
        }
        return result.reverse();  
    }

function ArchiveDirectory_getEntry( header, filename )
    {
        let node = header;
        const pathComponents = Path_splitFilename( filename ); 
        for ( let i = 0; i < pathComponents.length; ++i ) {
            if ( !Object.hasOwn( node, 'files' ) ) {
                node = node.files = {};
            } else {
                node = node.files;
            }
            const dirname = pathComponents[i];
            if ( !Object.hasOwn( node, dirname ) ) {
                node = node[dirname] = {};
            // Making a test every pass, ugh.
            } else if ( i !== pathComponents.length - 1 ) {
                node = node[dirname];
            } else {
                throw new TypeError( `Duplicate file ${filename}` );
                
            } 
        }
        
        return node; 
    }

function Archive_createHeaderBuffers( directory )
    {
        const headerText = encoder.encode( JSON.stringify( directory ) ),
              headerLength = headerText.byteLength,
              headerLengthBuffer = new DataView( new ArrayBuffer( 16 ) );
        
        const padding = 4 - ( headerLength & 3 );
        headerLengthBuffer.setUint32( 0, 4, true );  
        headerLengthBuffer.setUint32( 4, headerLength + 8 + padding, true );
        headerLengthBuffer.setUint32( 8, headerLength + 4 + padding, true );
        headerLengthBuffer.setUint32( 12, headerLength, true );
        return {
            headerLength: new Uint8Array( headerLengthBuffer.buffer ),
            headerText,
            headerPadding: new Uint8Array( padding )
        }; 
    }

export default function Archive_build( archiveMembers, { integrity: withIntegrity = true } = {} )
    {
        const directory = {},
              // reserve to buffers for the headerLength, headerText and headerPadding.
              buffers = [ null, null, null ];
        
        let byteOffset = 0;
        for ( const archiveMember of archiveMembers ) {
            const { name, buffer, integrity } = Archive_sanitiseMember( archiveMember, buffers.length - 3, withIntegrity );
            // We could also do with passing the member index, too.
            const node = ArchiveDirectory_getEntry( directory, name );
            // We match the official dist order which is `size`, `offset`, `integrity`; 
            // with `offset` as a string and `size` as a number.
            node.size = buffer.byteLength;
            node.offset = byteOffset.toString();
            if ( typeof integrity !== 'undefined' )
                node.integrity = integrity;
            buffers.push( buffer );
            byteOffset += buffer.byteLength;  
        }
        // We've probably run out of memory by now, but...
        if ( typeof byteOffset > Number.MAX_SAFE_INTEGER )
            throw new RangeError( "Archive too big" );
        
        const {headerLength,headerText, headerPadding} = Archive_createHeaderBuffers( directory );
        
        // Buffer requires this to be a Uint8Array. 
        buffers[0] = headerLength;
        buffers[1] = headerText;
        buffers[2] = headerPadding;
        // I originally returned a blob, it seemed a good fit, but `blobb.arrayBuffer()` is async
        // and we've gone through all this effort to make it synchronous.  
        return Buffer.concat( buffers );
    }



        