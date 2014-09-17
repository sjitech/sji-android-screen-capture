#!/bin/sh

./1_download_ffmpeg.sh || exit 1
./9_build_ffmpeg_armv5.sh || exit 1
./9_build_ffmpeg_armv7.sh || exit 1
