#!/bin/sh

echo ---------------download libvpx--------------------
ls -d ffmpeg_src/libvpx_src && { echo ffmpeg_src/libvpx_src already exist; exit 0; }
ls libvpx-v1.3.0.tar.bz2 || { wget https://webm.googlecode.com/files/libvpx-v1.3.0.tar.bz2 || exit 1; }
tar -xvjf libvpx-v1.3.0.tar.bz2 || exit 1
mv libvpx-v1.3.0 ffmpeg_src/libvpx_src || exit 1

echo ""; echo ok; echo ""
