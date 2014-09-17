#!/bin/sh
ORIG_DIR=~/Downloads/ffmpeg-2.4
diff -C2 $ORIG_DIR/configure             patch_ffmpeg_configure;
diff -C2 $ORIG_DIR/ffmpeg.c              patch_ffmpeg_ffmpeg.c;
