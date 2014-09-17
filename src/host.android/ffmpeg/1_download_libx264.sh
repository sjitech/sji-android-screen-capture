#!/bin/sh

echo ---------------download libx264--------------------
ls -d ffmpeg_src/libx264_src && { echo ffmpeg_src/libx264_src already exist; exit 0; }
ls libx264.tgz || { wget -O libx264.tgz "http://git.videolan.org/?p=x264.git;a=snapshot;h=refs/heads/stable;sf=tgz" || exit 1; }
rm -fr x264*
tar -xvzf libx264.tgz || exit 1
echo ""
mv -v x264* ffmpeg_src/libx264_src || exit 1

echo ""; echo ok; echo ""
