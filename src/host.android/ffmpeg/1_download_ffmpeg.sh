#!/bin/sh

echo ---------------download ffmpeg--------------------
ls -d ffmpeg_src && { echo ffmpeg_src already exist; exit 0; }
ls ffmpeg-2.4.tar.bz2 || { wget http://www.ffmpeg.org/releases/ffmpeg-2.4.tar.bz2 || exit 1; }
tar -xvjf ffmpeg-2.4.tar.bz2 || exit 1
mv ffmpeg-2.4 ffmpeg_src || exit 1

echo ""; echo ok; echo ""
