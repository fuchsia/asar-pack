
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
        } else if ( typeof data === 'object' && data && typeof data.buffer === 'object' && typeof data.byteLength === 'number' && typeof data.byteOffset === 'number' ) {
            // 1. Buffers.concat() is fussy about having Uint8Array.
            // 2. The allocated buffer might not be the size of the data - hence the slice syntax.
            // 3. NB Uint8Array will validate the parameters for us. Although the exception is not informative. 
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

function Archive_createHeader( directory )
    {
        const HEADER_LENGTH = 16,
              MAX_PADDING = 3;

        const directoryText = JSON.stringify( directory ),
              // We create a single buffer that's blank padded with enough byte for the header and for the
              // padding.
              //
              // Unfortunately we can't work out the exact size of this buffer is advance because we don't
              // know how many multibyte characters we have.
              // 
              // (@issue when we encode the header we could encode the names as \uxxxx and then the character
              // count would be the byte count.)  
              header = encoder.encode( ' '.repeat( HEADER_LENGTH ) + directoryText  + ' '.repeat( MAX_PADDING ) ),
              directoryBytes = header.byteLength - HEADER_LENGTH - MAX_PADDING,
              headerView = new DataView( header.buffer, header.byteOffset, header.byteLength );
        
        const padding = 4 - ( directoryBytes & 3 );
        headerView.setUint32( 0, 4, true );  
        headerView.setUint32( 4, directoryBytes + 8 + padding, true );
        headerView.setUint32( 8, directoryBytes + 4 + padding, true );
        headerView.setUint32( 12, directoryBytes, true );

        // There are MAX_PADDING spaces at the end of the buffer that need to be converted
        // to nulls to properly pad the buffer. We set them all out of paranoia!
        //
        // An alternative plan would be to leave them as is and blank pad the direcotry. That would simplify the 
        // code but it would mean we are not binary compatible with the stock implementation. So we leave it
        // as is, for the moment. 
        for ( let i = 0; i < MAX_PADDING; ++i ) 
            headerView.setInt8( header.byteLength - MAX_PADDING + i, 0 );
        
        return new Uint8Array( header.buffer, header.byteOffset, HEADER_LENGTH + directoryBytes + padding );
    }

export function packv( archiveMembers, { integrity: withIntegrity = true } = {} )
    {
        const directory = {},
              // reserve a buffer for the header.
              buffers = [ null ];
        
        let byteOffset = 0;
        for ( const archiveMember of archiveMembers ) {
            const { name, buffer, integrity } = Archive_sanitiseMember( archiveMember, buffers.length - 1, withIntegrity );
            // We could also do with passing the member index, too.
            const node = ArchiveDirectory_getEntry( directory, name );
            // The official dist order which is `size`, `offset`, `integrity`, 
            // with `offset` as a string and `size` as a number. We match that.
            // (That limits file size to MAX_SAFE_INTEGER but we could have multiple
            // such files if we handled BigInt for the offset. Storing the latter
            // as a string makes it accessible without writing a custom JSON parser.)
            node.size = buffer.byteLength;
            node.offset = byteOffset.toString();
            if ( typeof integrity !== 'undefined' )
                node.integrity = integrity;
            buffers.push( buffer );
            byteOffset += buffer.byteLength;  
        }
        // We'll probably run out of memory long before this check succeeds. (MAX_SAFE_INTEGER is >8TB) 
        // But try anyway. NB the use of NaN safe syntax.
        if ( !( byteOffset <= Number.MAX_SAFE_INTEGER  ) )
            throw new RangeError( "Archive too big" );
        
        buffers[0] = Archive_createHeader( directory );
        return buffers;
    }

export default function pack( archiveMembers, options ) 
    {
        return Buffer.concat( packv( archiveMembers, options ) );
    }

export {pack};



        