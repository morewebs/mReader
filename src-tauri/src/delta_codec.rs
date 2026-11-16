use std::io::{self, BufReader, Read, Write};

use sha2::{Digest, Sha256};

/// Maximum decompressed artifact size allowed (256 MiB) to guard against zip/zstd bombs.
pub const MAX_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024;

/// 32 MiB zstd window covers the entire mReader executable / APK while keeping client memory bounded.
const WINDOW_LOG: u32 = 25;

/// Match table log used by the CI delta generator (32M slots).
#[allow(dead_code)]
const TABLE_LOG: u32 = 25;

/// High-ratio compression for CI-built fallback packages and patches.
#[allow(dead_code)]
pub const PACK_LEVEL: i32 = 19;

#[allow(dead_code)]
pub fn pack_reader_to_writer<R: Read, W: Write>(
    mut input: R,
    output: W,
    level: i32,
) -> io::Result<()> {
    let mut encoder = zstd::stream::Encoder::new(output, level)?;
    encoder.long_distance_matching(true)?;
    io::copy(&mut input, &mut encoder)?;
    encoder.finish()?;
    Ok(())
}

pub fn unpack_reader_to_writer<R: Read, W: Write>(input: R, mut output: W) -> io::Result<u64> {
    let decoder = zstd::stream::Decoder::new(BufReader::new(input))?;
    copy_capped(decoder, &mut output)
}

#[allow(dead_code)]
pub fn make_patch(base: &[u8], target: &[u8]) -> io::Result<Vec<u8>> {
    let mut encoder = zstd::stream::Encoder::with_dictionary(Vec::new(), PACK_LEVEL, base)?;
    encoder.window_log(WINDOW_LOG)?;
    encoder.long_distance_matching(true)?;
    encoder.set_parameter(zstd::zstd_safe::CParameter::HashLog(TABLE_LOG))?;
    encoder.set_parameter(zstd::zstd_safe::CParameter::ChainLog(TABLE_LOG))?;
    encoder.write_all(target)?;
    encoder.finish()
}

/// Streams a zstd dictionary patch against `base` directly into `output` without holding two
/// full artifact buffers in memory on low-RAM mobile devices.
pub fn apply_patch_to_writer<R: Read, W: Write>(
    base: &[u8],
    patch: R,
    mut output: W,
) -> io::Result<u64> {
    let mut decoder = zstd::stream::Decoder::with_dictionary(BufReader::new(patch), base)?;
    decoder.window_log_max(WINDOW_LOG)?;
    copy_capped(decoder, &mut output)
}

pub fn sha256_hex_reader<R: Read>(mut reader: R) -> io::Result<(u64, String)> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_ARTIFACT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "artifact exceeds maximum allowed size",
            ));
        }
        hasher.update(&buf[..n]);
    }
    let hex = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    Ok((total, hex))
}

fn copy_capped<R: Read, W: Write>(reader: R, output: &mut W) -> io::Result<u64> {
    let mut limited = reader.take(MAX_ARTIFACT_BYTES + 1);
    let written = io::copy(&mut limited, output)?;
    if written > MAX_ARTIFACT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "decompressed update exceeds maximum allowed size",
        ));
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn synthetic_binary(seed: u32, len: usize) -> Vec<u8> {
        let mut state = seed;
        (0..len)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 16) as u8
            })
            .collect()
    }

    #[test]
    fn pack_and_unpack_roundtrips_streaming() {
        let raw = synthetic_binary(42, 250_000);
        let mut packed = Vec::new();
        pack_reader_to_writer(Cursor::new(&raw), &mut packed, 6).expect("pack");

        let mut unpacked = Vec::new();
        let bytes = unpack_reader_to_writer(Cursor::new(&packed), &mut unpacked).expect("unpack");
        assert_eq!(bytes as usize, raw.len());
        assert_eq!(unpacked, raw);
    }

    #[test]
    fn patch_handles_inserted_and_shifted_binary_sections() {
        let old = synthetic_binary(7, 500_000);
        // Simulate a recompiled binary where 2 KB of JS changed and shifted later code by 512 bytes
        let mut new = Vec::with_capacity(old.len() + 512);
        new.extend_from_slice(&old[..180_000]);
        new.extend_from_slice(&synthetic_binary(99, 2_048));
        new.extend_from_slice(&old[181_536..]);

        let patch = make_patch(&old, &new).expect("make_patch");
        let mut reconstructed = Vec::new();
        apply_patch_to_writer(&old, Cursor::new(&patch), &mut reconstructed).expect("apply_patch");

        assert_eq!(reconstructed, new);
        assert!(
            patch.len() < 15_000,
            "expected tiny delta patch for shifted binary, got {} bytes",
            patch.len()
        );
    }

    #[test]
    fn wrong_base_never_produces_target_bytes() {
        let old = synthetic_binary(1, 200_000);
        let mut new = old.clone();
        new[10_000..10_200].fill(0xAA);
        let patch = make_patch(&old, &new).expect("patch");

        let wrong_base = synthetic_binary(2, 200_000);
        let mut out = Vec::new();
        if apply_patch_to_writer(&wrong_base, Cursor::new(&patch), &mut out).is_ok() {
            assert_ne!(out, new);
        }
    }
}
