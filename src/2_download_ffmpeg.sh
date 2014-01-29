#!/bin/sh

echo ---------------download ffmpeg--------------------
/bin/ls -d ffmpeg_src && { echo ffmpeg_src already exist; exit 0; }
/bin/ls -d ffmpeg-2.1.3.tar.bz2 || { wget http://www.ffmpeg.org/releases/ffmpeg-2.1.3.tar.bz2 || exit 1; }
tar -xvjf ffmpeg-2.1.3.tar.bz2 || exit 1
mv ffmpeg-2.1.3 ffmpeg_src || exit 1

echo ""; echo ok; echo ""
