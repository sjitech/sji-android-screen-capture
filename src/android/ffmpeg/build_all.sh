#!/bin/sh

./0_make_ndk_toolchain.sh || exit 1
./1_download_ffmpeg.sh || exit 1
./9_build_ffmpeg_armv5.sh || exit 1
./9_build_ffmpeg_armv7.sh || exit 1
./9_build_ffmpeg_armv7-pie.sh || exit 1
