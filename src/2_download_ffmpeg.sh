#!/bin/sh

echo ---------------download ffmpeg--------------------
/bin/ls -d ffmpeg_src && { echo ffmpeg_src already exist; exit 0; }
/bin/ls -d ffmpeg-2.1.tar.bz2 || { wget http://www.ffmpeg.org/releases/ffmpeg-2.1.tar.bz2 || exit 1; }
tar -xvjf ffmpeg-2.1.tar.bz2 || exit 1
mv ffmpeg-2.1 ffmpeg_src || exit 1

echo ---------------download libvpx--------------------
/bin/ls -d ffmpeg_src/libvpx_src && { echo ffmpeg_src/libvpx_src already exist; exit 0; }
/bin/ls -d libvpx-v1.2.0.tar.bz2 || { wget https://webm.googlecode.com/files/libvpx-v1.2.0.tar.bz2 || exit 1; }
tar -xvjf libvpx-v1.2.0.tar.bz2 || exit 1
mv libvpx-v1.2.0 ffmpeg_src/libvpx_src || exit 1

echo ""; echo ok; echo ""
