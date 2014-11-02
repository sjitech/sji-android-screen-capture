#!/bin/sh

./0_make_ndk_toolchain.sh || exit 1
./1_download_ffmpeg.sh || exit 1
./1_download_libvpx.sh || exit 1
./1_download_libx264.sh || exit 1
./2_build_libvpx_armv7.sh || exit 1
./3_build_libx264_armv7.sh || exit 1
./9_build_ffmpeg_armv7.sh || exit 1
