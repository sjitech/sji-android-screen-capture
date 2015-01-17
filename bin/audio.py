#!/usr/bin/python
 
import usb
import time
import sys
import errno
 
ANDROID_VENDOR_ID_LIST = (0x0502, 0x1914, 0x1F3A, 0x1b8e, 0x16D5, 0x0E79, 0x0b05, 0x1D91, 0x04B7, 0x1219, 0x413c, 0x03fc, 0x297F, 0x2207, 0x0489, 0x04C5, 0x0F1C, 0x091E, 0x0414, 0x1E85, 0x271D, 0x18d1, 0x201E, 0x19A5, 0x109b, 0x0c2e, 0x03f0, 0x0bb4, 0x12D1, 0x2314, 0x8087, 0x067e, 0x2420, 0x24E3, 0x2116, 0x2237, 0x0482, 0x1949, 0x17EF, 0x2006, 0x1004, 0x25E3, 0x2A96, 0x22b8, 0x0DB0, 0x0e8d, 0x0409, 0x2080, 0x0955, 0x22D9, 0x2257, 0x2836, 0x10A9, 0x1D4D, 0x0471, 0x04DA, 0x1662, 0x29e4, 0x1D45, 0x05c6, 0x0408, 0x1532, 0x2207, 0x04e8, 0x04dd, 0x1F53, 0x29a9, 0x1d9c, 0x054C, 0x0FCE, 0x1BBB, 0x1d09, 0x2340, 0x0451, 0x0930, 0x1E68, 0x2A49, 0xE040, 0x0531, 0x2717, 0x2916, 0x1EBF, 0x19D2)
ANDROID_AUDIO_PRODUCT_ID_LIST = (0x2D02, 0x2D03)

def log(msg):
    sys.stderr.write(msg + '\n')

def main():
    serial_number = None
    dev = None

    if len(sys.argv) > 1:
        serial_number = sys.argv[1]
        for _dev in usb.core.find(find_all=True, custom_match = lambda d: d.idVendor in ANDROID_VENDOR_ID_LIST):
            if _dev.serial_number == serial_number:
                dev = _dev
                break
    else:
        for _dev in usb.core.find(find_all=True, custom_match = lambda d: d.idVendor in ANDROID_VENDOR_ID_LIST):
            if serial_number == None:
                serial_number = _dev.serial_number
                dev = _dev
            else:
                log("more than one device, please specify serial number to use")
                sys.exit(1)

    if dev == None:
        log("device not found")
        sys.exit(1)

    if dev.idProduct in ANDROID_AUDIO_PRODUCT_ID_LIST:
        log("device is already in audio mode")
    else:
        log("set to audio mode")
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 2, "d") == 1 #description 
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 3, "v") == 1 #version
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 4, "u") == 1 #url
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 52, 0, 5, "s") == 1 #serialNumber   
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 58, 1, 0, "") == 0  #set stereo audio
        assert dev.ctrl_transfer( usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT, 53, 0, 0, "") == 0  #accessory_start

    intf = None
    ep_in = None
    start_tm = time.time()

    while True:
        try:
            if dev == None:
                for _dev in usb.core.find(find_all=True, custom_match = lambda d: d.idVendor in ANDROID_VENDOR_ID_LIST):
                    if _dev.serial_number == serial_number:
                        dev = _dev
                        break

            if dev != None:
                cfg = dev.get_active_configuration()

                for intf in usb.util.find_descriptor(cfg, find_all=True, bInterfaceClass=1): #1 means audio
                    # log("intf: "+str(intf))
                    ep_in = usb.util.find_descriptor( intf, custom_match = lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN and (e.bmAttributes & 3) == 1) #1 means Isochronous
                    # log("Endpoint: "+str(ep_in))
                    if ep_in != None: break
                if ep_in != None: break;

                intf = None
                dev = None

        except usb.core.USBError as e:
            pass

        if time.time() - start_tm >= 5:
            log("time out")
            sys.exit(1)

        time.sleep(0.25)

    intf.set_altsetting()

    log("OK, start read. wMaxPacketSize:"+str(ep_in.wMaxPacketSize))

    buf = usb.util.create_buffer(ep_in.wMaxPacketSize*16)
    buf_l = usb.util.create_buffer(ep_in.wMaxPacketSize*8)

    while True:
        n = 0
        try:
            n = ep_in.read(buf, 10*1000)
        except usb.core.USBError as e:
            if e.errno != errno.ETIMEDOUT:
                log("read err "+ str(e))
                exit(1)
        if n > 0:
            log("----read "+str(n) + " bytes----")
            n = n/4*4
            # buf.tofile(sys.stdout)
            i = 2
            j = 0
            while i < n:
                buf_l[j] = buf[i]
                buf_l[j+1] = buf[i+1]
                j = j+2
                i = i+4
            buf_l.tofile(sys.stdout)
 
    log("exiting application")

try:
    main()
except KeyboardInterrupt:
    sys.exit(1) # or 1, or whatever
