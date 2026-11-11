import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WagerService } from '../../application/services/wager.service';
import { ProcessWagerDto, ProcessWagerResult } from '../../application/dtos/wager.dto';

@Controller('v1/wagers')
export class WagerController {
    constructor(private readonly wagerService: WagerService) { }

    @Post()
    @HttpCode(HttpStatus.OK)
    async processWager(@Body() dto: ProcessWagerDto): Promise<ProcessWagerResult> {
        return await this.wagerService.processWager(dto);
    }
}