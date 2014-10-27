#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }


SYS_ROOT="$ANDROID_NDK_ROOT/platforms/android-8/arch-arm"
TOOL_CHAIN_DIR=`ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-4.*/prebuilt/* | tail -n 1` || exit 1
LIBGCC_DIR=`ls -d $TOOL_CHAIN_DIR/lib/gcc/arm-linux-androideabi/4.* | tail -n 1` || exit 1
LIBEXEC_DIR=`ls -d $TOOL_CHAIN_DIR/libexec/gcc/arm-linux-androideabi/4.* | tail -n 1` || exit 1
CPP_ROOT=`ls -d $ANDROID_NDK_ROOT/sources/cxx-stl/gnu-libstdc++/4.* | tail -n 1` || exit 1
MAKE_DIR=`ls -d $ANDROID_NDK_ROOT/prebuilt/*/bin | tail -n 1` || exit 1
export  CFLAGS="-O3 --sysroot=$SYS_ROOT -I$SYS_ROOT/usr/include -I$LIBGCC_DIR/include -I$CPP_ROOT/include"
export LDFLAGS="-B$SYS_ROOT/usr/lib -B$LIBGCC_DIR -B$TOOL_CHAIN_DIR/arm-linux-androideabi/bin -B$LIBEXEC_DIR -B$CPP_ROOT/libs/armeabi"
export PATH="$TOOL_CHAIN_DIR/arm-linux-androideabi/bin:$LIBEXEC_DIR:$MAKE_DIR:$PATH"
export CC=gcc

export CPPFLAGS="-fno-rtti -fno-exceptions -fmax-errors=5"

mkdir bin 2>/dev/null
rm -f *.so

TARGET_DIR=../../../bin/android

v=220
echo ""
echo ---------------android $v --------------------
echo ---------------make sc-$v --------------------
g++ $CFLAGS $CPPFLAGS $LDFLAGS -DANDROID_VER=$v -fPIC -shared get-raw-image.cpp -o $TARGET_DIR/sc-$v || exit 1

echo ---------------make sc-$v test launcher --------------------
g++ $CFLAGS $CPPFLAGS $LDFLAGS -DANDROID_VER=$v -DMAKE_TEST=1 get-raw-image.cpp -o bin/sc-$v -Xlinker -rpath=/system/lib || exit 1

for v in 400 420; do
    echo ""
    echo ---------------android $v --------------------
	for f in libgui libbinder libutils; do
		echo ---------------make $f.so --------------------
		g++ $CFLAGS $CPPFLAGS $LDFLAGS -DANDROID_VER=$v -fPIC -shared $f.cpp -o $f.so || exit 1
	done

	echo ---------------make sc-$v --------------------
	g++ $CFLAGS $CPPFLAGS $LDFLAGS -DANDROID_VER=$v -fPIC -shared get-raw-image.cpp *.so -o $TARGET_DIR/sc-$v -Xlinker -rpath=/system/lib || exit 1

	echo ---------------make sc-$v test launcher --------------------
	g++ $CFLAGS $CPPFLAGS $LDFLAGS -DANDROID_VER=$v -DMAKE_TEST=1 get-raw-image.cpp *.so -o bin/sc-$v -Xlinker -rpath=/system/lib || exit 1

	rm -f *.so
done

echo ""; echo ok; echo ""
