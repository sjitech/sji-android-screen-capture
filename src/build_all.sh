#!/bin/sh

./1_build_get-raw-image.sh || exit 1
./2_download_ffmpeg.sh || exit 1
./3_build_libvpx_armv5.sh || exit 1
./4_build_libvpx_armv7.sh || exit 1
./5_build_ffmpeg_armv5.sh || exit 1
./6_build_ffmpeg_armv7.sh || exit 1
