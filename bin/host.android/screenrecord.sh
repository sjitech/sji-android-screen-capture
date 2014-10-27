
#Note: if you edit this file on Windows OS, please be sure to use
#UNIX style new line code, i mean 0xA (LF). Do not save 0xD 0xA!

#---------------------------------------------------------------------
# Usage:
# cd DIR_OF_THIS_SCRIPT
# sh screencord.sh OUTPUT_FILE FEED_FPS HEIGHT ORIENTATION
#     ORIENTATION: portrait or landscape
#---------------------------------------------------------------------

log() {
    echo $* >&2
}

log "------------------- start recording `date` ----------------------"

SIDE_DIR=../android
chmod 755 ffmpeg* $SIDE_DIR/* || exit 1

OUTPUT_FILE="$1"; shift || { log "require arg2: output file path. Example: /sdcard/test.mp4"; exit 1; }
FEED_FPS="$1"; shift || { log "require arg3: frames_per_second of raw image. Example: 4"; exit 1; }
HEIGHT="$1"; shift || { log "require arg4: size of long side of result video. Example: 1080"; exit 1; }
ORIENTATION="$1";

echo $HEIGHT | $SIDE_DIR/busybox grep -Eq "^[1-9][0-9]+$" || { log "size \"$HEIGHT\" is not valid"; exit 1; }
FILTER="scale=ceil(iw/ih*$HEIGHT/2)*2:ceil($HEIGHT/2)*2"
$SIDE_DIR/busybox [ "$ORIENTATION" == "landscape" ] && FILTER="$FILTER,transpose=2"

export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:$SIDE_DIR #just for bug of dlopen(relPath) in android 2.3-

log "--------------------------------------------------------------------------------------------------------------------------------"
log "./ffmpeg -f androidgrab -r \"$FEED_FPS\" -probesize 32 -i ../android/sc-420 -vf \"$FILTER\" -pix_fmt yuv420p \"$OUTPUT_FILE\" -y"
     ./ffmpeg -f androidgrab -r  "$FEED_FPS"  -probesize 32 -i ../android/sc-420 -vf  "$FILTER"  -pix_fmt yuv420p  "$OUTPUT_FILE"  -y
