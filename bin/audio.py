#!/usr/bin/python
 
import usb
import time
import sys
 
ADB_VID = 0x18D1
AUDIO_ADB_PID = 0x2D03
 
def main():
    dev = usb.core.find(idVendor=ADB_VID);
    if dev is None:
        raise ValueError("No compatible device not found")
 
    if dev.idProduct == AUDIO_ADB_PID:
        log("device is already in audio+adb mode")
    else:
        log("set to audio+adb device")
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 2, "d") == 1 #description 
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 3, "v") == 1 #version
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 4, "u") == 1 #url
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 5, "s") == 1 #serialNumber   
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 58, 1, 0, "") == 0  #set stereo audio
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 53, 0, 0, "") == 0  #accessory_start

    log(str(dev))

    start_tm = time.time()
    while time.time() - start_tm < 2:
        dev = usb.core.find(idVendor=ADB_VID, idProduct=AUDIO_ADB_PID);
        if dev != None:
            cfg = dev.get_active_configuration()
            intf = usb.util.find_descriptor(cfg, bInterfaceNumber = 1, bAlternateSetting=1)
            log("intf: "+str(intf))
            if intf != None:
                ep_in = usb.util.find_descriptor( intf, custom_match = lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN )
                log("Endpoint: "+str(ep_in))
                if ep_in != None: break

    dev.set_interface_altsetting(interface=1, alternate_setting=1)

    log("OK, start read. wMaxPacketSize:"+str(ep_in.wMaxPacketSize))
    buf = usb.util.create_buffer(ep_in.wMaxPacketSize*16)
    len = 0
    while True:
        try:
            len = ep_in.read(buf, timeout = 1000)
        except usb.core.USBError as e:
            if e.errno !=60:
                log("read err "+ str(e) + " backend_error_code:"+str(e.backend_error_code))
                break
        if len:
            log("read "+str(len) + " bytes")
            buf.tofile(sys.stdout)
 
    log("exiting application")

def log(msg):
    sys.stderr.write(msg + '\n')

if __name__ == "__main__":
    main()
