#!/bin/sh

ls -d ../../ndk_toolchain > /dev/null || { echo please execute ./0_make_ndk_toolchain.sh first; exit 1; }

export PATH="$PWD/../../ndk_toolchain/bin:$PATH"
export CC=arm-linux-androideabi-gcc

cd ./ffmpeg_src            || { echo please download ffmpeg source to [./ffmpeg_src];            exit 1; }

echo ---------------make cpu-features lib--------------------
printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }
mkdir ./otherlib
$CC -c $ANDROID_NDK_ROOT/sources/android/cpufeatures/cpu-features.c  -o ./otherlib/cpu-features.o || exit 1
echo ""; echo ok; echo ""

echo ---------------patch some files--------------------
cp -fv ../../../android/ffmpeg/patch_ffmpeg_x11grab.c ./libavdevice/x11grab.c || exit 1
cp -fv ../../../android/ffmpeg/patch_ffmpeg_configure ./configure || exit 1
cp -fv ../../../android/ffmpeg/patch_ffmpeg_ffmpeg.c ./ffmpeg.c || exit 1
echo ""; echo ok; echo ""

echo ---------------config ffmpeg [armv7]--------------------
#extra flags for webm/vp8 and h264
export  CFLAGS="$CFLAGS  -I./libvpx_src/qj_armv7/include -I./libx264_src/qj_armv7/include"
export LDFLAGS="$LDFLAGS -B./libvpx_src/qj_armv7/lib ./otherlib/cpu-features.o -B./libx264_src/qj_armv7/lib"

./configure --enable-cross-compile --cross-prefix=arm-linux-androideabi- --target-os=linux \
    --arch=armv7 --cpu=armv7-a \
    --disable-doc --disable-ffplay --disable-ffprobe --disable-ffserver --disable-symver --disable-debug --disable-everything \
	--enable-protocol=pipe --enable-protocol=file --enable-protocol=tcp \
    --enable-static \
	--enable-filter=scale --enable-filter=crop --enable-filter=transpose \
	--enable-demuxer=rawvideo --enable-decoder=rawvideo \
	--enable-muxer=image2 --enable-muxer=image2pipe --enable-muxer=mjpeg --enable-encoder=mjpeg --enable-encoder=png \
	--enable-demuxer=image2 --enable-demuxer=image2pipe --enable-demuxer=mjpeg --enable-decoder=mjpeg --enable-decoder=png \
	--enable-libvpx \
	--enable-muxer=webm --enable-encoder=libvpx_vp8 \
	--enable-demuxer=matroska --enable-decoder=libvpx_vp8 \
	--enable-libx264 --enable-gpl \
	--enable-muxer=mp4 --enable-encoder=libx264 \
	--enable-demuxer=mov --enable-decoder=h264 \
	--enable-x11grab --enable-indev=x11grab \
	|| exit 1

echo ---------------make ffmpeg [armv7]--------------------
make clean
make all || exit 1

cp -fv ./ffmpeg ../../../../bin/host.android/ffmpeg || exit 1

echo ""; echo ok; echo ""