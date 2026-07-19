import { IAttachment, IEmailOptions } from './type';
import { SendMailClient } from 'zeptomail';

export class ZeptoMail {
  async sendMailWithZepto(data: IEmailOptions) {
    return new Promise(async (resolve, reject) => {
      try {
        const {
          recipient,
          subject,
          attachments = [],
          allow_to_reply = false,
          reply_to_email = null,
          template_id,
          template_variables = {},
          cc = null,
          bcc = null,
          send_attachment = true,
        } = data;

        const mailSender = new SendMailClient({
          url: process.env.ZEPTOMAIL_API_BASE_URL || '',
          token: process.env.ZEPTOMAIL_API_TOKEN || '',
        });

        const sender = {
          address: process.env.ZEPTOMAIL_MAIL_FROM_ADDRESS,
          name: process.env.ZEPTOMAIL_MAIL_FROM_NAME,
        };
        const receiver = [
          {
            email_address: {
              address: recipient,
            },
          },
        ];

        const _attachments = [];
        // if (attachments && attachments.length > 0) {
        //   for (let i = 0; i < attachments.length; i += 1) {
        //     const attachmentData = await this.getFileAndFileNameForZepto(
        //       attachments[i],
        //     );
        //     _attachments.push({
        //       name: attachmentData.file_name,
        //       content: attachmentData.data,
        //       mime_type: attachmentData.mime_type,
        //     });
        //   }
        // }

        let message = {
          from: sender,
          to: receiver,
          subject,
          template_key: template_id,
          merge_info: template_variables,
        } as any;

        // add attachment if it is allowed and available
        if (send_attachment && _attachments.length > 0) {
          message = { ...message, attachments: _attachments };
        }

        // add replyTo if it is allowed
        if (allow_to_reply) {
          message = { ...message, reply_to: reply_to_email };
        }

        // add cc if it is allowed
        if (cc) {
          const cc_emails = cc.map((email) => {
            return { email_address: { address: email } };
          });
          message = { ...message, cc: cc_emails };
        }

        // add bcc if it is allowed
        if (bcc) {
          const bcc_emails = bcc.map((email) => {
            return { email_address: { address: email } };
          });
          message = { ...message, bcc: bcc_emails };
        }

        await mailSender.sendMailWithTemplate(message);
        console.log(`Successfully sent email to ${recipient}`);
        resolve({ done: true });
      } catch (error) {
        if (
          error.toString().indexOf('parameter is not a valid address') !== -1
        ) {
          resolve({
            done: true,
          });
        }

        reject(error);
      }
    });
  }
}
